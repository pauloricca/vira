#include <CoreMIDI/CoreMIDI.h>
#include <CoreFoundation/CoreFoundation.h>
#include <mach/mach_time.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
typedef void (*Receiver)(void*,uint8_t,uint8_t,uint8_t,uint64_t);
typedef struct {MIDIClientRef client; MIDIPortRef input,output; MIDIEndpointRef source,destination;Receiver receive;void* context;uint8_t status,data[2],count;atomic_flag reading;} ViraMidi;
static _Atomic uint64_t time_numer=0,time_denom=1;
uint64_t vira_midi_now_ns(void){
    uint64_t numer=atomic_load(&time_numer);
    if(!numer){mach_timebase_info_data_t t;mach_timebase_info(&t);atomic_store(&time_denom,t.denom);atomic_store(&time_numer,t.numer);numer=t.numer;}
    return (uint64_t)((long double)mach_absolute_time()*numer/atomic_load(&time_denom));
}
static uint64_t from_ticks(uint64_t ticks){mach_timebase_info_data_t t;mach_timebase_info(&t);return ticks?(uint64_t)((long double)ticks*t.numer/t.denom):vira_midi_now_ns();}
static void read_midi(const MIDIPacketList* list,void* context,void* source){
    (void)source;ViraMidi* m=context;if(atomic_flag_test_and_set(&m->reading)){m->receive(m->context,0xff,0,0,vira_midi_now_ns());return;}
    const MIDIPacket* packet=&list->packet[0];
    for(UInt32 p=0;p<list->numPackets;p++){
        for(UInt16 i=0;i<packet->length;i++){
            uint8_t b=packet->data[i];if(b>=0xf8)continue;
            if(b&0x80){m->status=b<0xf0?b:0;m->count=0;continue;}
            if(!m->status)continue;
            m->data[m->count++]=b;
            int length=(m->status&0xf0)==0xc0||(m->status&0xf0)==0xd0?1:2;
            if(m->count==length){if(length==2)m->receive(m->context,m->status,m->data[0],m->data[1],from_ticks(packet->timeStamp));m->count=0;}
        }
        packet=MIDIPacketNext(packet);
    }
    atomic_flag_clear(&m->reading);
}
void* vira_midi_open(Receiver callback,void* context){
    ViraMidi* m=calloc(1,sizeof(*m));if(!m)return NULL;atomic_flag_clear(&m->reading);m->receive=callback;m->context=context;
    if(MIDIClientCreate(CFSTR("VIRA Teia"),NULL,NULL,&m->client)!=noErr||MIDIInputPortCreate(m->client,CFSTR("VIRA Teia input"),read_midi,m,&m->input)!=noErr||MIDIOutputPortCreate(m->client,CFSTR("VIRA Teia output"),&m->output)!=noErr){if(m->client)MIDIClientDispose(m->client);free(m);return NULL;}return m;
}
void vira_midi_close(void* handle){ViraMidi* m=handle;if(m){MIDIClientDispose(m->client);free(m);}}
size_t vira_midi_count(bool output){return output?MIDIGetNumberOfDestinations():MIDIGetNumberOfSources();}
bool vira_midi_endpoint(bool output,size_t index,int32_t* id,char* name,size_t len){
    MIDIEndpointRef e=output?MIDIGetDestination(index):MIDIGetSource(index);if(!e)return false;
    if(MIDIObjectGetIntegerProperty(e,kMIDIPropertyUniqueID,id)!=noErr)return false;
    CFStringRef text=NULL;if(MIDIObjectGetStringProperty(e,kMIDIPropertyDisplayName,&text)!=noErr)return false;
    Boolean ok=CFStringGetCString(text,name,len,kCFStringEncodingUTF8);CFRelease(text);return ok;
}
static MIDIEndpointRef endpoint(bool output,int32_t id){for(size_t i=0;i<vira_midi_count(output);i++){int32_t candidate;MIDIEndpointRef e=output?MIDIGetDestination(i):MIDIGetSource(i);if(MIDIObjectGetIntegerProperty(e,kMIDIPropertyUniqueID,&candidate)==noErr&&candidate==id)return e;}return 0;}
int vira_midi_select(void* handle,int32_t input,int32_t output){
    ViraMidi* m=handle;MIDIEndpointRef next=endpoint(false,input);
    if(m->source!=next && m->source)MIDIPortDisconnectSource(m->input,m->source);
    // Acquire parser state only on the ordinary device worker, never the audio thread.
    while(atomic_flag_test_and_set(&m->reading)){}
    m->status=0;m->count=0;atomic_flag_clear(&m->reading);
    OSStatus status=next && next!=m->source?MIDIPortConnectSource(m->input,next,NULL):noErr;
    m->source=next;m->destination=endpoint(true,output);
    return status!=noErr?status:((input&&!m->source)||(output&&!m->destination)?-1:0);
}
bool vira_midi_connected(void* handle){ViraMidi* m=handle;int32_t id;return (!m->source||MIDIObjectGetIntegerProperty(m->source,kMIDIPropertyUniqueID,&id)==noErr)&&(!m->destination||MIDIObjectGetIntegerProperty(m->destination,kMIDIPropertyUniqueID,&id)==noErr);}
int vira_midi_send(void* handle,uint8_t status,uint8_t a,uint8_t b,uint64_t ns){
    ViraMidi* m=handle;if(!m->destination)return 0;
    mach_timebase_info_data_t time;mach_timebase_info(&time);MIDITimeStamp stamp=(MIDITimeStamp)((long double)ns*time.denom/time.numer);
    union {MIDIPacketList aligned;Byte bytes[512];} buffer;MIDIPacketList* list=&buffer.aligned;MIDIPacket* packet=MIDIPacketListInit(list);Byte bytes[3]={status,a,b};
    if(!MIDIPacketListAdd(list,sizeof(buffer),packet,stamp,3,bytes))return -1;
    return MIDISend(m->output,m->destination,list);
}
